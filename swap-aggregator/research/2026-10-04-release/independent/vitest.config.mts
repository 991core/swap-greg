import base from "../../../vitest.config.mts";
export default { ...base, test: { ...base.test, include: ["research/2026-10-04-release/independent/*.after.repro.test.ts"] } };
