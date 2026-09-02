import { Suspense } from "react";
import { FavoritesPage } from "@/components/favorites-page";

export default function Favorites() {
  return <Suspense><FavoritesPage /></Suspense>;
}
