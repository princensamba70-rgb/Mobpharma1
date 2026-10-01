// Validation des requêtes avec Zod
export function validate(schema, source = 'body') {
  return (req, res, next) => {
    const result = schema.safeParse(req[source]);
    if (!result.success) {
      return res.status(400).json({
        error: 'Données invalides',
        details: result.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })),
      });
    }
    req.validated = result.data;
    next();
  };
}
