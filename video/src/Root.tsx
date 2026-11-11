import React from "react";
import { Composition, staticFile } from "remotion";
import { loadFont } from "@remotion/fonts";
import { FPS, RoleGuide, totalFrames } from "./RoleGuide";
import data from "./data.json";

loadFont({ family: "InterCyr", url: staticFile("fonts/inter-cyr.woff2"), weight: "100 900" });
loadFont({ family: "InterLat", url: staticFile("fonts/inter-lat.woff2"), weight: "100 900" });

export const RemotionRoot: React.FC = () => {
  return (
    <>
      {data.map((r) => (
        <Composition
          key={r.key}
          id={`role-${r.key}`}
          component={RoleGuide}
          durationInFrames={totalFrames(r)}
          fps={FPS}
          width={1920}
          height={1080}
          defaultProps={{ roleKey: r.key }}
        />
      ))}
    </>
  );
};
