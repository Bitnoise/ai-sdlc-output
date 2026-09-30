import { homePage } from "../src/views";

describe("views", () => {
  it("shows the welcome message on the home page", () => {
    const html = homePage();

    expect(html).toContain("<h1>Welcome!</h1>");
    expect(html).toContain("Welcome home!");
  });
});
