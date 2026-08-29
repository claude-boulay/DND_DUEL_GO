import type { NextFunction, Request, RequestHandler, Response } from 'express';

/** Express 4 ne capture pas les rejets de promesses dans les handlers async : ce wrapper le fait. */
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<void>,
): RequestHandler {
  return (req, res, next) => {
    fn(req, res, next).catch(next);
  };
}
