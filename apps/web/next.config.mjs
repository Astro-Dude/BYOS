/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  // @byos/api-client ships raw TS, consumed directly from source.
  transpilePackages: ["@byos/api-client"],
  // Dev only: the Next badge sits bottom left, clear of the landing page's
  // Bao jail at the bottom right.
  devIndicators: { position: "bottom-left" },
};

export default nextConfig;
