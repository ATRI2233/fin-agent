/**
 * FRED Browse API Client
 *
 * Provides comprehensive browsing of FRED categories, releases, and sources
 */
import { makeRequest } from "../common/request.js";
import { handleToolError, formatPaginationDisplay, buildQueryParams } from "./helpers.js";
import { z } from "zod";

/**
 * Category schema
 */
const CategorySchema = z.object({
  id: z.number(),
  name: z.string(),
  parent_id: z.number(),
});

/**
 * Release schema
 */
const ReleaseSchema = z.object({
  id: z.number(),
  realtime_start: z.string(),
  realtime_end: z.string(),
  name: z.string(),
  press_release: z.boolean(),
  link: z.string().optional(),
  notes: z.string().optional(),
});

/**
 * Source schema
 */
const SourceSchema = z.object({
  id: z.number(),
  realtime_start: z.string(),
  realtime_end: z.string(),
  name: z.string(),
  link: z.string().optional(),
  notes: z.string().optional(),
});

/**
 * Schema for category/series API response
 */
const CategorySeriesResponseSchema = z.object({
  realtime_start: z.string(),
  realtime_end: z.string(),
  count: z.number(),
  offset: z.number(),
  limit: z.number(),
  seriess: z.array(z.object({
    id: z.string(),
    title: z.string(),
    units: z.string(),
    frequency: z.string(),
    observation_start: z.string(),
    observation_end: z.string(),
    last_updated: z.string()
  }))
});

/**
 * Schema for release/series API response
 */
const ReleaseSeriesResponseSchema = z.object({
  realtime_start: z.string(),
  realtime_end: z.string(),
  count: z.number(),
  offset: z.number(),
  limit: z.number(),
  seriess: z.array(z.object({
    id: z.string(),
    title: z.string(),
    units: z.string(),
    frequency: z.string(),
    observation_start: z.string(),
    observation_end: z.string(),
    last_updated: z.string()
  }))
});

export type Category = z.infer<typeof CategorySchema>;
export type Release = z.infer<typeof ReleaseSchema>;
export type Source = z.infer<typeof SourceSchema>;

/**
 * Browse all FRED categories
 */
export async function browseCategories(categoryId?: number) {
  try {
    const endpoint = categoryId ? `category/children` : "category";
    const queryParams = buildQueryParams(
      categoryId !== undefined ? { category_id: categoryId } : {}
    );

    const response = await makeRequest<{
      categories: Category[];
    }>(endpoint, queryParams);

    return {
      content: [{
        type: "text" as const,
        text: JSON.stringify({
          categories: response.categories.map(cat => ({
            id: cat.id,
            name: cat.name,
            parent_id: cat.parent_id
          }))
        }, null, 2)
      }]
    };
  } catch (error) {
    return handleToolError(error, "browse categories");
  }
}

/**
 * Get series in a specific category
 */
export async function getCategorySeries(categoryId: number, options: {
  limit?: number;
  offset?: number;
  order_by?: string;
  sort_order?: "asc" | "desc";
  filter_variable?: string;
  filter_value?: string;
} = {}) {
  try {
    const queryParams = buildQueryParams(options as Record<string, unknown>, { category_id: categoryId });
    const response = CategorySeriesResponseSchema.parse(
      await makeRequest("category/series", queryParams)
    );

    return {
      content: [{
        type: "text" as const,
        text: JSON.stringify({
          category_id: categoryId,
          total_series: response.count,
          showing: formatPaginationDisplay(response.offset, response.limit, response.count),
          series: response.seriess.map(s => ({
            id: s.id,
            title: s.title,
            units: s.units,
            frequency: s.frequency,
            observation_range: `${s.observation_start} to ${s.observation_end}`,
            last_updated: s.last_updated
          }))
        }, null, 2)
      }]
    };
  } catch (error) {
    return handleToolError(error, "get category series");
  }
}

/**
 * Browse all FRED releases
 */
export async function browseReleases(options: {
  limit?: number;
  offset?: number;
  order_by?: string;
  sort_order?: "asc" | "desc";
} = {}) {
  try {
    const queryParams = buildQueryParams(options as Record<string, unknown>);

    const response = await makeRequest<{
      realtime_start: string;
      realtime_end: string;
      order_by: string;
      sort_order: string;
      count: number;
      offset: number;
      limit: number;
      releases: Release[];
    }>("releases", queryParams);

    return {
      content: [{
        type: "text" as const,
        text: JSON.stringify({
          total_releases: response.count,
          showing: formatPaginationDisplay(response.offset, response.limit, response.count),
          releases: response.releases.map(rel => ({
            id: rel.id,
            name: rel.name,
            press_release: rel.press_release,
            link: rel.link
          }))
        }, null, 2)
      }]
    };
  } catch (error) {
    return handleToolError(error, "browse releases");
  }
}

/**
 * Get series in a specific release
 */
export async function getReleaseSeries(releaseId: number, options: {
  limit?: number;
  offset?: number;
  order_by?: string;
  sort_order?: "asc" | "desc";
} = {}) {
  try {
    const queryParams = buildQueryParams(options as Record<string, unknown>, { release_id: releaseId });
    const response = ReleaseSeriesResponseSchema.parse(
      await makeRequest("release/series", queryParams)
    );

    return {
      content: [{
        type: "text" as const,
        text: JSON.stringify({
          release_id: releaseId,
          total_series: response.count,
          showing: formatPaginationDisplay(response.offset, response.limit, response.count),
          series: response.seriess.map(s => ({
            id: s.id,
            title: s.title,
            units: s.units,
            frequency: s.frequency,
            observation_range: `${s.observation_start} to ${s.observation_end}`,
            last_updated: s.last_updated
          }))
        }, null, 2)
      }]
    };
  } catch (error) {
    return handleToolError(error, "get release series");
  }
}

/**
 * Browse all FRED sources
 */
export async function browseSources(options: {
  limit?: number;
  offset?: number;
  order_by?: string;
  sort_order?: "asc" | "desc";
} = {}) {
  try {
    const queryParams = buildQueryParams(options as Record<string, unknown>);

    const response = await makeRequest<{
      realtime_start: string;
      realtime_end: string;
      order_by: string;
      sort_order: string;
      count: number;
      offset: number;
      limit: number;
      sources: Source[];
    }>("sources", queryParams);

    return {
      content: [{
        type: "text" as const,
        text: JSON.stringify({
          total_sources: response.count,
          showing: formatPaginationDisplay(response.offset, response.limit, response.count),
          sources: response.sources.map(src => ({
            id: src.id,
            name: src.name,
            link: src.link
          }))
        }, null, 2)
      }]
    };
  } catch (error) {
    return handleToolError(error, "browse sources");
  }
}