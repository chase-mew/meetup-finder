import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type Favourite,
  findFavourite,
  isSameFavourite,
  loadFavourites,
  normaliseName,
  persistFavourites,
  removeFavourite,
  upsertFavourite,
} from "./favourites";

function makeFavourite(overrides: Partial<Favourite> = {}): Favourite {
  return {
    id: "fav-1",
    label: "Alice",
    address: "10 Downing Street",
    location: { lat: 51.5, lng: -0.1 },
    resolvedAddress: "10 Downing St, London",
    ...overrides,
  };
}

function createStorageMock() {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string): string | null => (key in store ? store[key]! : null),
    setItem: (key: string, value: string): void => {
      store[key] = value;
    },
    removeItem: (key: string): void => {
      delete store[key];
    },
    clear: (): void => {
      store = {};
    },
    get raw(): Record<string, string> {
      return store;
    },
  };
}

describe("normaliseName", () => {
  it("trims, lower-cases, and collapses whitespace", () => {
    expect(normaliseName("  Alice  ")).toBe("alice");
    expect(normaliseName("Bob   Smith")).toBe("bob smith");
    expect(normaliseName("CHARLIE")).toBe("charlie");
  });
});

describe("isSameFavourite", () => {
  it("matches by normalised name regardless of distance", () => {
    const a = { label: "Alice", location: { lat: 51.5, lng: -0.1 } };
    const b = { label: "  alice ", location: { lat: 40.0, lng: 5.0 } };
    expect(isSameFavourite(a, b)).toBe(true);
  });

  it("matches by location proximity even with different names", () => {
    const a = { label: "Alice", location: { lat: 51.5, lng: -0.1 } };
    const b = { label: "Alice home", location: { lat: 51.5003, lng: -0.1 } };
    expect(isSameFavourite(a, b)).toBe(true);
  });

  it("does not match distinct names that are far apart", () => {
    const a = { label: "Alice", location: { lat: 51.5, lng: -0.1 } };
    const b = { label: "Bob", location: { lat: 51.52, lng: -0.12 } };
    expect(isSameFavourite(a, b)).toBe(false);
  });

  it("ignores empty names so two unnamed far-apart places differ", () => {
    const a = { label: "  ", location: { lat: 51.5, lng: -0.1 } };
    const b = { label: "", location: { lat: 51.52, lng: -0.12 } };
    expect(isSameFavourite(a, b)).toBe(false);
  });
});

describe("upsertFavourite", () => {
  it("appends a new favourite", () => {
    const list = [makeFavourite()];
    const next = upsertFavourite(list, makeFavourite({ id: "fav-2", label: "Bob", location: { lat: 52, lng: 1 } }));
    expect(next).toHaveLength(2);
    expect(next[1]?.label).toBe("Bob");
  });

  it("replaces a duplicate by name in place and keeps the original id", () => {
    const list = [makeFavourite({ id: "fav-1", label: "Alice", address: "old" })];
    const next = upsertFavourite(
      list,
      makeFavourite({ id: "fav-new", label: "alice", address: "new" }),
    );
    expect(next).toHaveLength(1);
    expect(next[0]?.id).toBe("fav-1");
    expect(next[0]?.address).toBe("new");
  });

  it("replaces a duplicate by proximity", () => {
    const list = [makeFavourite({ id: "fav-1", label: "Alice", location: { lat: 51.5, lng: -0.1 } })];
    const next = upsertFavourite(
      list,
      makeFavourite({ id: "fav-2", label: "Alice work", location: { lat: 51.5002, lng: -0.1 } }),
    );
    expect(next).toHaveLength(1);
    expect(next[0]?.id).toBe("fav-1");
    expect(next[0]?.label).toBe("Alice work");
  });

  it("keeps distinct people", () => {
    const list = [makeFavourite({ id: "fav-1", label: "Alice", location: { lat: 51.5, lng: -0.1 } })];
    const next = upsertFavourite(
      list,
      makeFavourite({ id: "fav-2", label: "Bob", location: { lat: 52.5, lng: 0.5 } }),
    );
    expect(next.map((f) => f.label)).toEqual(["Alice", "Bob"]);
  });
});

describe("removeFavourite", () => {
  it("removes the favourite with the given id", () => {
    const list = [makeFavourite({ id: "a" }), makeFavourite({ id: "b", label: "Bob", location: { lat: 52, lng: 1 } })];
    expect(removeFavourite(list, "a").map((f) => f.id)).toEqual(["b"]);
  });

  it("leaves the list unchanged when the id is missing", () => {
    const list = [makeFavourite({ id: "a" })];
    expect(removeFavourite(list, "missing")).toHaveLength(1);
  });
});

describe("findFavourite", () => {
  it("finds a matching favourite", () => {
    const list = [makeFavourite({ id: "a", label: "Alice", location: { lat: 51.5, lng: -0.1 } })];
    const found = findFavourite(list, { label: "alice", location: { lat: 51.5, lng: -0.1 } });
    expect(found?.id).toBe("a");
  });

  it("returns undefined when nothing matches", () => {
    const list = [makeFavourite({ id: "a", label: "Alice", location: { lat: 51.5, lng: -0.1 } })];
    expect(findFavourite(list, { label: "Zoe", location: { lat: 10, lng: 10 } })).toBeUndefined();
  });
});

describe("loadFavourites and persistFavourites", () => {
  let storage: ReturnType<typeof createStorageMock>;

  beforeEach(() => {
    storage = createStorageMock();
    vi.stubGlobal("localStorage", storage);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns an empty list when nothing is stored", () => {
    expect(loadFavourites()).toEqual([]);
  });

  it("round trips a saved list", () => {
    const list = [makeFavourite()];
    persistFavourites(list);
    expect(loadFavourites()).toEqual(list);
  });

  it("returns an empty list for malformed JSON", () => {
    storage.setItem("favourites", "{not valid json");
    expect(loadFavourites()).toEqual([]);
  });

  it("returns an empty list when the stored value is not an array", () => {
    storage.setItem("favourites", JSON.stringify({ nope: true }));
    expect(loadFavourites()).toEqual([]);
  });

  it("filters out entries with the wrong shape", () => {
    const good = makeFavourite({ id: "good" });
    storage.setItem(
      "favourites",
      JSON.stringify([
        good,
        { id: "missing-location", label: "X", address: "Y" },
        { id: 5, label: "bad id", address: "Z", location: { lat: 1, lng: 1 } },
        { id: "bad-coords", label: "X", address: "Y", location: { lat: "no", lng: 1 } },
      ]),
    );
    expect(loadFavourites()).toEqual([good]);
  });

  it("returns an empty list when reading throws", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {},
    });
    expect(loadFavourites()).toEqual([]);
  });

  it("ignores write failures", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => null,
      setItem: () => {
        throw new Error("quota exceeded");
      },
    });
    expect(() => persistFavourites([makeFavourite()])).not.toThrow();
  });
});
