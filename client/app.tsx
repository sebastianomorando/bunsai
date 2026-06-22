import { render } from "preact";
import { LocationProvider } from "preact-iso";
import { AppLayout } from "./AppLayout.tsx";

render(
  <LocationProvider>
    <AppLayout />
  </LocationProvider>,
  document.getElementById("app")!
);
