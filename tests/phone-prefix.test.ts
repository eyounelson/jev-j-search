import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { DumpedField } from "../src/forms/fields.js";
import { hasPrefixBox, planField } from "../src/forms/mapForm.js";
import type { Job } from "../src/jobs/normalize.js";
import { ProfileSchema } from "../src/profile/schema.js";

const raw = JSON.parse(readFileSync(new URL("../data/profile.example.json", import.meta.url), "utf8")) as { phone: Record<string, string> };
const canadian = ProfileSchema.parse(raw);
// A made-up number with another country's code.
const abroad = ProfileSchema.parse({ ...raw, phone: { national: "8005550123", countryCode: "+234" } });

const field = (over: Partial<DumpedField>): DumpedField => ({ id: "f0", widget: "", selector: "#x", kind: "text", name: "", label: "", hint: "", placeholder: "", required: false, value: "", options: [], accept: "", maxLength: null, autocomplete: "", buttonGroup: false, section: "", ...over });
const job = { id: "j", source: "t", company: "Acme", title: "Backend Engineer", url: "https://jobs.ashbyhq.com/acme/1", ats: "ashby", locations: ["Remote"], postedAt: "2026-10-01", terms: [], sponsorship: "unknown", degrees: [], category: null } as Job;
const phone = field({ kind: "tel", label: "Phone", placeholder: "1-415-555-1234..." });

describe("the phone box", () => {
  it("takes the whole international number when the form has no box for the code and the number is not North American", () => {
    expect(planField(phone, undefined, abroad, job, false)).toMatchObject({ action: "fill", key: "phone_with_country_code", value: "+2348005550123" });
  });
  it("takes national digits when the form has its own box for the code, which is filled with the profile's code", () => {
    expect(planField(phone, undefined, abroad, job, true)).toMatchObject({ action: "fill", key: "phone", value: "8005550123" });
  });
  it("keeps national digits for a +1 number, as before", () => {
    expect(planField(phone, undefined, canadian, job, false)).toMatchObject({ key: "phone", value: "5555550123" });
  });
  it("sees a box of its own for the code, but not a flag drawn inside the phone box", () => {
    expect(hasPrefixBox([phone, field({ id: "f1", kind: "select", label: "Country code" })])).toBe(true);
    expect(hasPrefixBox([phone, field({ id: "f1", kind: "combobox", label: "Phone prefix" })])).toBe(true);
    expect(hasPrefixBox([field({ kind: "tel", widget: "intl-tel", label: "Phone" })])).toBe(false);
    expect(hasPrefixBox([phone, field({ id: "f1", kind: "select", label: "Country of residence" })])).toBe(false);
  });
});
