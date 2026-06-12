const express = require('express');

const app = express();
const port = process.env.PORT || 8080;

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: '${{ values.name }}' });
});

app.get('/', (_req, res) => {
  res.json({ message: 'Hello from ${{ values.name }}' });
});

app.listen(port, () => {
  console.log('${{ values.name }} listening on ' + port);
});