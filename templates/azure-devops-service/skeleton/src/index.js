const express = require('express');

const app = express();
const port = process.env.PORT || 8080;

app.get('/health', (_request, response) => {
  response.json({ status: 'ok', service: '${{ values.name }}' });
});

app.get('/', (_request, response) => {
  response.send('${{ values.name }} is running');
});

app.listen(port, () => {
  console.log(`${{ values.name }} listening on port ${port}`);
});
