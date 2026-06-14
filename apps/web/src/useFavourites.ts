import { useCallback, useState } from "react";
import {
  type Favourite,
  loadFavourites,
  persistFavourites,
  removeFavourite as removeFromList,
  upsertFavourite,
} from "./favourites";

/**
 * Holds the saved favourite people in React state and keeps localStorage in
 * sync, mirroring the persistence approach in useTheme. Reads once on mount.
 */
export function useFavourites(): {
  favourites: Favourite[];
  saveFavourite: (favourite: Favourite) => void;
  deleteFavourite: (id: string) => void;
} {
  const [favourites, setFavourites] = useState<Favourite[]>(loadFavourites);

  const saveFavourite = useCallback((favourite: Favourite) => {
    setFavourites((prev) => {
      const next = upsertFavourite(prev, favourite);
      persistFavourites(next);
      return next;
    });
  }, []);

  const deleteFavourite = useCallback((id: string) => {
    setFavourites((prev) => {
      const next = removeFromList(prev, id);
      persistFavourites(next);
      return next;
    });
  }, []);

  return { favourites, saveFavourite, deleteFavourite };
}
