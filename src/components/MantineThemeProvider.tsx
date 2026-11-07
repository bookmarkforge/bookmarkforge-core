import React from "react";
import { MantineProvider, createTheme } from "@mantine/core";

const theme = createTheme({
  primaryColor: "brandCyan",
  colors: {
    brandCyan: [
      "#e6f7fd",
      "#b3ecf9",
      "#80e0f5",
      "#4dd4f1",
      "#1ac8ed",
      "#00aeef",
      "#0d7fc4",
      "#0a6a9e",
      "#075578",
      "#044052",
    ],
  },
});

export default function MantineThemeProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  return <MantineProvider theme={theme}>{children}</MantineProvider>;
}
