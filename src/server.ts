import express from "express";
import { mainPre, main1 } from "./index.js";
import { EmailMessage } from "./types/EmailMessage.js";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, "../public")));

// API endpoint for Q-PRE - Get busy time intervals
app.get("/api/busy-intervals", (_req, res) => {
  try {
    const intervals = mainPre();
    res.json({ intervals });
  } catch (error) {
    console.error("Error getting busy intervals:", error);
    res.status(500).json({ error: "Failed to get busy intervals" });
  }
});

// API endpoint for Q-MAIN-1 - Suggest meeting slots
app.post("/api/suggest-slots", async (req, res): Promise<void> => {
  try {
    const { emailMessage, useDeterministic = false } = req.body;

    if (!emailMessage) {
      res.status(400).json({ error: "emailMessage is required" });
      return;
    }

    // Convert date strings to Date objects
    const processedEmail: EmailMessage = {
      ...emailMessage,
      sentAt: new Date(emailMessage.sentAt),
    };

    const slots = await main1({
      usersEmailMessage: processedEmail,
      useDeterministic,
    });

    res.json({ slots });
    return;
  } catch (error) {
    console.error("Error suggesting slots:", error);
    res.status(500).json({ error: "Failed to suggest meeting slots" });
    return;
  }
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});

