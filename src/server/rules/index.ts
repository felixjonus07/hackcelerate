/**
 * Rules engine public API. Pure: no I/O, no clock, no network (§10.1).
 * Must not import from db, cache, llm, queue or next/*.
 */
export * from "./aeg";
export * from "./evaluate";
export * from "./integrity";
export * from "./normalize";
export * from "./routing";
export * from "./score";
export * from "./types";
export * from "./version";
