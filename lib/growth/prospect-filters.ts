/**
 * The active-filter chips on the prospect database.
 *
 * THE BUG. The page renders "N prospects matching your filters" whenever any
 * filter is on — so it TELLS you the list is narrowed — but the only way back
 * to everything was a "clear filter" link that rendered for exactly one filter
 * (`due`) and nothing else. Tick "Has phone", or pick a status, an industry or
 * a campaign from the panel, and the list silently narrows with no visible way
 * to widen it again.
 *
 * The one other clear affordance sat inside the empty state, so it appeared
 * only when NOTHING matched — the clear link existed precisely when there was
 * nothing to clear it from, and vanished the moment it would have been useful.
 *
 * In practice that means arriving from a dashboard count, ticking Has phone to
 * dial, and then being stuck on a filtered list with no obvious way out short
 * of re-navigating. On a database of a few thousand that reads as "where did
 * all my prospects go".
 *
 * Each chip clears only ITSELF, keeping the others — narrowing by three things
 * and wanting to drop one shouldn't mean starting over.
 */

export type ProspectFilterParams = {
  q?: string;
  status?: string;
  industry?: string;
  campaign?: string;
  phone?: string;
  due?: string;
  stage?: string;
  sort?: string;
};

export type FilterChip = {
  /** Which query param this chip represents. */
  key: keyof ProspectFilterParams;
  /** What it says on the chip. */
  label: string;
  /** URL with this ONE filter removed and the rest kept. */
  clearHref: string;
};

/** Human labels for the follow-up buckets, shared with the page. */
export const DUE_CHIP_LABELS: Record<string, string> = {
  today: "follow-up due today",
  overdue: "follow-up overdue",
  live: "follow-up due or overdue",
  cold: "gone cold (7+ days)",
  unscheduled: "no next step booked",
};

/** Human labels for the stage buckets — a GROUP of statuses, not one. */
export const STAGE_CHIP_LABELS: Record<string, string> = {
  to_research: "still to research",
};

/**
 * Builds the href for the prospect list with `omit` removed.
 *
 * `page` is deliberately never carried: dropping a filter widens the result
 * set, and staying on page 7 of a list that just changed shape is how a user
 * lands on a page that no longer means anything.
 */
export function filterHref(
  params: ProspectFilterParams,
  omit?: keyof ProspectFilterParams
): string {
  const sp = new URLSearchParams();
  const put = (key: keyof ProspectFilterParams, value: string | undefined) => {
    if (key === omit) return;
    const v = (value ?? "").trim();
    if (v) sp.set(key, v);
  };
  put("q", params.q);
  put("status", params.status);
  put("industry", params.industry);
  put("campaign", params.campaign);
  put("phone", params.phone === "1" ? "1" : undefined);
  put("due", params.due);
  put("sort", params.sort);
  const qs = sp.toString();
  return qs ? `/growth/prospects?${qs}` : "/growth/prospects";
}

/**
 * One chip per ACTIVE filter, in the order they read most naturally.
 *
 * `sort` is deliberately not a chip: it reorders the list, it doesn't hide
 * anything, so offering to "clear" it would imply rows were being withheld.
 *
 * @param campaignName resolves a campaign id to its name — an id on a chip is
 *   useless to a human.
 */
export function activeFilterChips(
  params: ProspectFilterParams,
  campaignName?: (id: string) => string | undefined
): FilterChip[] {
  const chips: FilterChip[] = [];
  const q = (params.q ?? "").trim();
  const status = (params.status ?? "").trim();
  const industry = (params.industry ?? "").trim();
  const campaign = (params.campaign ?? "").trim();
  const due = (params.due ?? "").trim();
  const stage = (params.stage ?? "").trim();

  if (q) chips.push({ key: "q", label: `“${q}”`, clearHref: filterHref(params, "q") });
  if (status) {
    chips.push({ key: "status", label: status.replace(/_/g, " "), clearHref: filterHref(params, "status") });
  }
  if (industry) {
    chips.push({ key: "industry", label: industry, clearHref: filterHref(params, "industry") });
  }
  if (campaign) {
    chips.push({
      key: "campaign",
      label: campaignName?.(campaign) ?? "campaign",
      clearHref: filterHref(params, "campaign"),
    });
  }
  if (params.phone === "1") {
    chips.push({ key: "phone", label: "has phone", clearHref: filterHref(params, "phone") });
  }
  if (due) {
    chips.push({
      key: "due",
      label: DUE_CHIP_LABELS[due] ?? due,
      clearHref: filterHref(params, "due"),
    });
  }
  if (stage) {
    chips.push({
      key: "stage",
      label: STAGE_CHIP_LABELS[stage] ?? stage,
      clearHref: filterHref(params, "stage"),
    });
  }
  return chips;
}

/** True when anything is narrowing the list. Sort alone doesn't count. */
export function hasActiveFilters(params: ProspectFilterParams): boolean {
  return activeFilterChips(params).length > 0;
}
