export function isStandaloneRootPath(pathname: string): boolean {
  return (
    pathname === "/pair" ||
    pathname === "/plugins/oauth/callback" ||
    pathname === "/connect" ||
    pathname.startsWith("/connect/")
  );
}
