import React from "react";
import { Composition } from "remotion";
import { Short, shortDurationInFrames } from "./Short";
import { DEFAULT_PROPS, SHORT_FPS, SHORT_HEIGHT, SHORT_WIDTH } from "./theme";

export const Root: React.FC = () => {
  return (
    <Composition
      id="Short"
      component={Short as unknown as React.FC<Record<string, unknown>>}
      durationInFrames={shortDurationInFrames(DEFAULT_PROPS)}
      fps={SHORT_FPS}
      width={SHORT_WIDTH}
      height={SHORT_HEIGHT}
      defaultProps={DEFAULT_PROPS}
      calculateMetadata={({ props }) => {
        const p = props as unknown as import("./theme").ShortProps;
        return {
          durationInFrames: shortDurationInFrames(p),
          props,
        };
      }}
    />
  );
};
