// Wraps an API route so a crash (usually MongoDB being unreachable) comes
// back as a readable JSON error instead of a bare "HTTP 500".
module.exports = (fn) => async (req, res) => {
  try {
    await fn(req, res);
  } catch (err) {
    console.error(err);
    if (!res.headersSent) res.status(500).json({ error: `Server error: ${err.message}` });
  }
};
