import baseConfig from "./vitest.config";

export default {
  ...baseConfig,
  test: {
    ...(baseConfig.test ?? {}),
    exclude: [...(baseConfig.test?.exclude ?? [])],
    coverage: {
      ...(baseConfig.test?.coverage ?? {}),
      all: true,
      include: ["src/services/UniversalImporter.ts"],
      reporter: ["json"],
    },
  },
};
