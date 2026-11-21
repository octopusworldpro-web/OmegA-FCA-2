"use strict";

const levels = Object.freeze({ error: 0, warn: 1, info: 2, verbose: 3, debug: 4 });
let currentLevel = "warn";
function emit(level, scope, message) {
  if (levels[level] > levels[currentLevel]) return;
  const text = "[OmegA-FCA:E2EE] " + String(scope || "client") + ": " + String(message || "");
  if (level === "error" || level === "warn") console.error(text);
}
module.exports = {
  setLevel(level) { if (Object.prototype.hasOwnProperty.call(levels, level)) currentLevel = level; },
  error: (scope, message) => emit("error", scope, message),
  warn: (scope, message) => emit("warn", scope, message),
  info: (scope, message) => emit("info", scope, message),
  verbose: (scope, message) => emit("verbose", scope, message),
  debug: (scope, message) => emit("debug", scope, message)
};
