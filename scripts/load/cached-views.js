// k6 load test for cached views (§10.3): p95 < 1 s for signed-in reads at 50 virtual users.
//
//   k6 run -e BASE=http://localhost:3100 -e DEMO_PASSWORD=... scripts/load/cached-views.js
//
// Each virtual user signs in once as the demo student, then reads the passport and the leaderboard repeatedly.
// Sign-in is rate-limited per IP, so every user sends its own x-forwarded-for.

import { check, sleep } from "k6";
import http from "k6/http";

const BASE = __ENV.BASE || "http://localhost:3100";
const PASSWORD = __ENV.DEMO_PASSWORD;

export const options = {
  scenarios: {
    readers: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: "30s", target: 50 },
        { duration: "1m", target: 50 },
        { duration: "10s", target: 0 },
      ],
    },
  },
  thresholds: {
    "http_req_duration{view:passport}": ["p(95)<1000"],
    "http_req_duration{view:leaderboard}": ["p(95)<1000"],
    http_req_failed: ["rate<0.01"],
  },
};

export function setup() {
  if (!PASSWORD) throw new Error("Set DEMO_PASSWORD");
}

export default function () {
  const ip = `10.88.${__VU % 250}.${(__VU * 7) % 250}`;
  const headers = { "content-type": "application/json", origin: BASE, "x-forwarded-for": ip };
  if (__ITER === 0) {
    const r = http.post(
      `${BASE}/api/auth/sign-in/email`,
      JSON.stringify({ email: "student@aspiredge.example", password: PASSWORD }),
      { headers },
    );
    check(r, { "signed in": (x) => x.status === 200 });
  }
  const passport = http.get(`${BASE}/api/v1/students/me/passport`, { headers, tags: { view: "passport" } });
  check(passport, { "passport 200": (x) => x.status === 200 });
  const board = http.get(`${BASE}/api/v1/leaderboards`, { headers, tags: { view: "leaderboard" } });
  check(board, { "leaderboard 2xx": (x) => x.status < 300 });
  sleep(1);
}
