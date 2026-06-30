/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  // @byos/api-client ships raw TS, consumed directly from source.
  transpilePackages: ["@byos/api-client"],
};

export default nextConfig;
