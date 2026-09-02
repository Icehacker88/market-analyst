import Link, { type LinkProps } from "next/link";
import type { AnchorHTMLAttributes } from "react";

type AppLinkProps = LinkProps & Omit<AnchorHTMLAttributes<HTMLAnchorElement>, keyof LinkProps>;

export function normalizedAppHref(href: LinkProps["href"]): LinkProps["href"] {
  if (typeof href !== "string" || !href.startsWith("/") || href.startsWith("//")) return href;
  const hashIndex = href.indexOf("#");
  const hash = hashIndex >= 0 ? href.slice(hashIndex) : "";
  const withoutHash = hashIndex >= 0 ? href.slice(0, hashIndex) : href;
  const queryIndex = withoutHash.indexOf("?");
  const query = queryIndex >= 0 ? withoutHash.slice(queryIndex) : "";
  const pathname = queryIndex >= 0 ? withoutHash.slice(0, queryIndex) : withoutHash;
  if (pathname === "/" || pathname.endsWith("/") || /\.[a-z0-9]+$/i.test(pathname)) return href;
  return `${pathname}/${query}${hash}`;
}

export function AppLink({ prefetch = false, ...props }: AppLinkProps) {
  return <Link prefetch={prefetch} {...props} href={normalizedAppHref(props.href)} />;
}
