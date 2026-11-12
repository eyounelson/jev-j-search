import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ALL_KEYS, valueFor } from "../src/profile/fieldKeys.js";
import { ProfileSchema } from "../src/profile/schema.js";

const raw = JSON.parse(readFileSync("data/profile.example.json", "utf8")) as { links: Record<string, unknown> };

describe("the X link", () => {
  it("is a field key the form mapper can offer", () => {
    expect(ALL_KEYS).toHaveProperty("twitter_url");
  });
  it("fills a box when the profile has one, and leaves it blank when it does not", () => {
    const without = ProfileSchema.parse(raw);
    const withLink = ProfileSchema.parse({ ...raw, links: { ...raw.links, twitter: "https://x.com/example" } });
    expect(valueFor(without, "twitter_url")).toBeNull();
    expect(valueFor(withLink, "twitter_url")).toBe("https://x.com/example");
  });
});
