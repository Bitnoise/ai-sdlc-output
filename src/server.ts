import { app } from "./app";
import { migrate } from "./db";

const PORT = Number(process.env.PORT ?? 3000);

migrate()
  .then(() => {
    app.listen(PORT, () => console.log(`Listening on http://localhost:${PORT}`));
  })
  .catch((err) => {
    console.error("Failed to start:", err);
    process.exit(1);
  });
