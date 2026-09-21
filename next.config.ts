import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Keep the dev-tools badge off the account picker in the sidebar's bottom-left corner.
  devIndicators: { position: "bottom-right" },
};

export default nextConfig;
