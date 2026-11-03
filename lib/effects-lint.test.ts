import { readdirSync, readFileSync } from "node:fs";
import { expect, it } from "vitest";

// An expression-bodied effect returns whatever its expression returns. When that
// is a Promise (Chromium's scrollIntoView now returns one), React crashes calling
// it as the cleanup. Effects here always use a block body.
it("no useEffect has an expression body", () => {
  const files = ["app.tsx", ...readdirSync("components").filter((f) => /\.tsx?$/.test(f)).map((f) => `components/${f}`)];
  const offenders = files.flatMap((file) =>
    readFileSync(file, "utf8")
      .split("\n")
      .map((line, i) => ({ line, at: `${file}:${i + 1}` }))
      .filter(({ line }) => /use(Layout)?Effect\(\(\) => (?![{(]|\(\) =>)/.test(line))
      .map(({ at }) => at),
  );
  expect(offenders).toEqual([]);
});
