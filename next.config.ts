import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  env: {
    APP_VERSION: require("./package.json").version,
    // Commit the build came from (set by Vercel); "dev" for local builds.
    BUILD_SHA: (process.env.VERCEL_GIT_COMMIT_SHA || "dev").slice(0, 7),
  },
  async headers() {
    return [
      {
        source: "/:path*.apk",
        headers: [
          { key: "Content-Type", value: "application/vnd.android.package-archive" },
          { key: "Content-Disposition", value: "attachment" },
        ],
      },
    ];
  },
};

export default nextConfig;
