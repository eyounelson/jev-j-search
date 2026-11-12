import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DISCOVER } from "../src/config.js";
import { isWantedTitle } from "../src/discover.js";
import type { Job } from "../src/jobs/normalize.js";
import { buildFitState, fitQuestions, ratingKey, scoreFromAnswers } from "../src/jobs/rate.js";
import { ProfileSchema, usStatus } from "../src/profile/schema.js";
import type { Answer } from "../src/jev/types.js";

const now = new Date("2026-10-02T12:00:00Z");
const raw = JSON.parse(readFileSync("data/profile.example.json", "utf8")) as { preferences: Record<string, unknown> };
const early = ProfileSchema.parse(raw);
const experienced = ProfileSchema.parse({ ...raw, preferences: { ...raw.preferences, targetLevel: "experienced" } });

const job = (over: Partial<Job> = {}): Job => ({
  id: "j", source: "t", company: "Acme", title: "Senior Backend Engineer", url: "https://job-boards.greenhouse.io/acme/jobs/1", ats: "greenhouse",
  locations: ["Remote"], postedAt: "2026-10-01", terms: [], sponsorship: "unknown", degrees: [], category: null, ...over,
});

/** The answers an experienced search gets: no term, no graduation, no returning-to-school question. */
function answers(over: Record<string, Partial<Answer>> = {}): Record<string, Answer> {
  const base: Record<string, Answer> = {
    is_software_role: { type: "noul", noul: 0.98 },
    level: { type: "choice", choice: "experienced", probabilities: { experienced: 1 }, confidence: 1 },
    is_unpaid: { type: "noul", noul: 0.02 },
    needs_advanced_degree: { type: "noul", noul: 0.02 },
    work_auth: { type: "choice", choice: "remote_global", probabilities: { remote_global: 1 }, confidence: 1 },
    stack_match: { type: "score", score: 3, legend: {}, probabilities: {}, confidence: 0.8 },
    experience_match: { type: "score", score: 4, legend: {}, probabilities: {}, confidence: 0.8 },
    location_tier: { type: "choice", choice: "remote", probabilities: {}, confidence: 1 },
    interview_practical: { type: "noul", noul: 0.3 },
    callback_likelihood: { type: "score", score: 3, legend: { "3": "Likely" }, probabilities: {}, confidence: 0.7 },
    needs_account: { type: "noul", noul: 0.1 },
    requires_references: { type: "noul", noul: 0.05 },
    offers_relocation: { type: "noul", noul: 0.05 },
    requires_other_authorization: { type: "noul", noul: 0.05 },
  };
  for (const [k, v] of Object.entries(over)) base[k] = { ...(base[k] as Answer), ...v } as Answer;
  return base;
}

const score = (a: Record<string, Answer>, j: Job = job()) => scoreFromAnswers(j, a, now, usStatus(experienced), "experienced");

describe("the target level", () => {
  it("is early career unless the profile says otherwise", () => {
    expect(early.preferences.targetLevel).toBe("early_career");
    expect(experienced.preferences.targetLevel).toBe("experienced");
  });
  it("keeps what a board posts by level: engineering titles for an experienced search, early-career titles otherwise", () => {
    for (const t of ["Senior Backend Engineer", "Staff Software Engineer", "Software Engineer", "Platform Developer", "Principal Architect"]) {
      expect(isWantedTitle(t, "experienced"), t).toBe(true);
      expect(isWantedTitle(t), t).toBe(false);
    }
    for (const t of ["Software Engineer Intern", "Junior Developer", "Software Engineer I", "Engineering Co-op", "Account Executive"]) {
      expect(isWantedTitle(t, "experienced"), t).toBe(false);
    }
    expect(isWantedTitle("Software Engineer Intern")).toBe(true);
  });
});

describe("the experienced questions", () => {
  it("leave out the term and the graduation, and add the two the candidate's situation needs", () => {
    const q = fitQuestions(experienced);
    for (const k of ["term", "graduation_excluded", "returning_student_required"]) expect(q).not.toHaveProperty(k);
    for (const k of ["offers_relocation", "requires_other_authorization", "level", "stack_match"]) expect(q).toHaveProperty(k);
    expect(JSON.stringify(q)).not.toMatch(/graduat|summer/i);
    for (const k of Object.keys(answers())) expect(q).toHaveProperty(k);
  });
  it("do not change for an early-career profile", () => {
    const q = fitQuestions(early);
    for (const k of ["term", "graduation_excluded"]) expect(q).toHaveProperty(k);
    for (const k of ["offers_relocation", "requires_other_authorization"]) expect(q).not.toHaveProperty(k);
  });
  it("tell the rating nothing about a graduation, and keep the two searches' cached ratings apart", () => {
    const state = buildFitState(job(), experienced, now) as { candidate: Record<string, unknown> };
    expect(state.candidate).not.toHaveProperty("graduation");
    expect(buildFitState(job(), early, now)).toHaveProperty("candidate.graduation");
    expect(ratingKey(job(), experienced)).not.toBe(ratingKey(job(), early));
  });
});

describe("scoring an experienced search", () => {
  it("queues a fresh remote senior role", () => {
    const fit = score(answers());
    expect(fit.skipReason).toBeNull();
    expect(fit.decision).toBe("apply");
    expect(fit.score).toBeGreaterThan(DISCOVER.applyThreshold);
  });
  it("no longer skips a role for asking for experience", () => {
    expect(score(answers({ level: { choice: "experienced", confidence: 0.95 } })).skipReason).toBeNull();
  });
  it("skips an internship unless the posting offers relocation", () => {
    const intern = { level: { choice: "internship", confidence: 0.9 } } as Record<string, Partial<Answer>>;
    expect(score(answers(intern)).skipReason).toBe("internship without relocation");
    expect(score(answers({ ...intern, offers_relocation: { noul: 0.9 } })).skipReason).toBeNull();
    // A level the rating is unsure of is not enough to skip.
    expect(score(answers({ level: { choice: "internship", confidence: 0.4 } })).skipReason).toBeNull();
  });
  it("skips a role that needs a right to work, or a move, the candidate has no help with", () => {
    const onSite = answers({ requires_other_authorization: { noul: 0.9 }, location_tier: { choice: "canada" } });
    expect(score(onSite, job({ locations: ["Toronto, ON"] })).skipReason).toMatch(/work authorization or a move/);
    expect(score(answers({ requires_other_authorization: { noul: 0.1 }, location_tier: { choice: "us" }, work_auth: { choice: "us_sponsors" } }), job({ locations: ["Austin, TX"] })).skipReason).toBeNull();
  });
  it("still skips a US role that refuses sponsorship", () => {
    const refuses = answers({ work_auth: { choice: "us_no_sponsorship", confidence: 0.9 } });
    expect(score(refuses, job({ locations: ["Austin, TX"] })).skipReason).toMatch(/no sponsorship/);
  });
  it("ranks remote above on site, and a regular level above a junior one", () => {
    const remote = score(answers()).score;
    const onSite = score(answers({ location_tier: { choice: "us" }, work_auth: { choice: "us_sponsors" } }), job({ locations: ["Austin, TX"] })).score;
    const junior = score(answers({ level: { choice: "new_grad", confidence: 0.9 } })).score;
    expect(remote).toBeGreaterThan(onSite);
    expect(remote).toBeGreaterThan(junior);
  });
});
