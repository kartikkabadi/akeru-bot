import {
  PLUGIN_CATEGORIES,
  type PluginCategory,
  type PluginDefinition,
} from "../../../../../plugins";

export type PluginFilter = "All" | "Featured" | PluginCategory;

export const PLUGIN_FILTERS: readonly PluginFilter[] = ["All", "Featured", ...PLUGIN_CATEGORIES];

/** Featured entries shown as cards on the All view before View all. */
const FEATURED_PREVIEW_COUNT = 4;

export interface PluginSection {
  readonly title: string;
  readonly filter: PluginFilter;
  readonly plugins: readonly PluginDefinition[];
  readonly showViewAll: boolean;
  readonly layout: "cards" | "rows";
}

export function buildInstalledPluginSection(input: {
  readonly plugins: readonly PluginDefinition[];
  readonly query: string;
}): readonly PluginSection[] {
  const query = input.query.trim().toLocaleLowerCase();
  const plugins = input.plugins.filter((plugin) =>
    `${plugin.title}\n${plugin.description}\n${plugin.category}`
      .toLocaleLowerCase()
      .includes(query),
  );
  return [{ title: "Installed", filter: "All", plugins, showViewAll: false, layout: "rows" }];
}

export function buildPluginSections(input: {
  readonly plugins: readonly PluginDefinition[];
  readonly query: string;
  readonly filter: PluginFilter;
}): readonly PluginSection[] {
  const query = input.query.trim().toLocaleLowerCase();
  const matching = input.plugins.filter((plugin) =>
    `${plugin.title}\n${plugin.description}\n${plugin.category}`
      .toLocaleLowerCase()
      .includes(query),
  );

  if (query) {
    const filtered =
      input.filter === "All"
        ? matching
        : matching.filter((plugin) =>
            input.filter === "Featured"
              ? plugin.featured === true
              : plugin.category === input.filter,
          );
    return [
      {
        title: "Search results",
        filter: input.filter,
        plugins: filtered,
        showViewAll: false,
        layout: "rows",
      },
    ];
  }

  if (input.filter === "Featured") {
    return [
      {
        title: "Featured",
        filter: "Featured",
        plugins: matching.filter((plugin) => plugin.featured === true),
        showViewAll: false,
        layout: "cards",
      },
    ];
  }

  if (input.filter !== "All") {
    return [
      {
        title: input.filter,
        filter: input.filter,
        plugins: matching.filter((plugin) => plugin.category === input.filter),
        showViewAll: false,
        layout: "rows",
      },
    ];
  }

  const featured = matching.filter((plugin) => plugin.featured === true);
  const sections: PluginSection[] = [
    {
      title: "Featured",
      filter: "Featured",
      plugins: featured.slice(0, FEATURED_PREVIEW_COUNT),
      showViewAll: featured.length > FEATURED_PREVIEW_COUNT,
      layout: "cards",
    },
  ];
  for (const category of PLUGIN_CATEGORIES) {
    const plugins = matching.filter((plugin) => plugin.category === category);
    if (plugins.length > 0) {
      sections.push({
        title: category,
        filter: category,
        plugins,
        showViewAll: true,
        layout: "rows",
      });
    }
  }
  return sections;
}
