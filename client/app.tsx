import { render } from "preact";

const App = () => {
  return <h1>Hello, World!</h1>;
};

render(<App />, document.getElementById("app")!);