/**
 * Which sidebar item is the current page. The longest matching href wins, so /analytics/studio lights up
 * "Dispute Studio" and not "Analytics" as well (both prefixes match it).
 */
export function activeHref(pathname: string, hrefs: string[]): string | undefined {
  const matches = hrefs.filter((href) =>
    href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`),
  );
  return matches.sort((a, b) => b.length - a.length)[0];
}
