#!/usr/bin/env node
import { main } from "../src/cli.js";
main().catch((e) => {
  if (e?.name === "ExitPromptError") process.exit(0);
  console.error("\n  error:", e.message);
  process.exit(1);
});
