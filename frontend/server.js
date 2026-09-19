import express from "express";

import path from "path";
import { fileURLToPath } from "url";


const app = express();
const PORT = 3000;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);


app.use(express.json());

app.get('/forensic-report', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.use(express.static(__dirname));


app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});