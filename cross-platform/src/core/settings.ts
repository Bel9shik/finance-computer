import {
  ownPhoneIDs,
  categorySettings,
  categoryName,
  uncategorized,
  reclassify,
  ruleKeys,
  type Ledger,
  type Rule,
  type Settings,
} from "./model";

// A merged group is imported as a whole, including all its alternative descriptions.
function ruleIndex(rules: Rule[]) {
  return {
    ids: new Set(rules.map((r) => r.id)),
    keys: new Set(rules.flatMap((r) => [...ruleKeys(r)])),
  };
}
function overlaps(r: Rule, index: ReturnType<typeof ruleIndex>) {
  return (
    index.ids.has(r.id) || [...ruleKeys(r)].some((key) => index.keys.has(key))
  );
}
export function mergeSettings(
  current: Ledger,
  incoming: Settings,
  preferFile = false,
) {
  const localRules = current.descriptionRules ?? [];
  const preferred = preferFile ? incoming.descriptionRules : localRules;
  const secondary = preferFile ? localRules : incoming.descriptionRules;
  const index = ruleIndex(preferred);
  const localIndex = ruleIndex(localRules);
  const settings: Settings = {
    descriptionRules: structuredClone([
      ...preferred,
      ...secondary.filter((r) => !overlaps(r, index)),
    ]),
    phoneNames: preferFile
      ? { ...current.phoneNames, ...incoming.phoneNames }
      : { ...incoming.phoneNames, ...current.phoneNames },
    transferOwners: preferFile
      ? { ...current.transferOwners, ...incoming.transferOwners }
      : { ...incoming.transferOwners, ...current.transferOwners },
    otherPhonesArePeople: preferFile
      ? incoming.otherPhonesArePeople
      : (current.otherPhonesArePeople ?? incoming.otherPhonesArePeople),
    mccCategories: preferFile
      ? { ...current.mccCategories, ...incoming.mccCategories }
      : { ...incoming.mccCategories, ...current.mccCategories },
    categoryRules: preferFile
      ? { ...categorySettings(current), ...categorySettings(incoming) }
      : { ...categorySettings(incoming), ...categorySettings(current) },
  };
  settings.categoryRules = categorySettings(settings);
  if (!ownPhoneIDs({ ...current, ...settings }).length)
    settings.otherPhonesArePeople = false;
  return {
    settings,
    overlaps: {
      rules: incoming.descriptionRules.filter((r) => overlaps(r, localIndex))
        .length,
      names: Object.keys(incoming.phoneNames).filter((id) =>
        Object.hasOwn(current.phoneNames ?? {}, id),
      ).length,
      owners: Object.keys(incoming.transferOwners).filter((id) =>
        Object.hasOwn(current.transferOwners ?? {}, id),
      ).length,
      mcc: Object.keys(incoming.mccCategories).filter((code) =>
        Object.hasOwn(current.mccCategories ?? {}, code),
      ).length,
      categories: Object.keys(incoming.categoryRules).filter((name) =>
        Object.hasOwn(current.categoryRules ?? {}, name),
      ).length,
    },
  };
}
export function applySettings(
  l: Ledger,
  incoming: Settings,
  preferFile = false,
) {
  Object.assign(l, mergeSettings(l, incoming, preferFile).settings);
  for (const o of l.operations)
    if (
      o.category !== uncategorized &&
      categoryName(l, o.category) === uncategorized
    )
      o.manualCategory = true;
  if (
    Object.keys(l.mccCategories ?? {}).length ||
    l.descriptionRules?.some((r) => r.matchMerchant)
  )
    l.classificationVersion = Math.max(l.classificationVersion ?? 1, 2);
  if (
    Object.keys(l.categoryRules ?? {}).length ||
    l.descriptionRules?.some((r) => r.ignoreMCC !== undefined)
  )
    l.version = 2;
  reclassify(l);
}
