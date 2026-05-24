import { Request, Response, NextFunction } from 'express'
import jwt from 'jsonwebtoken'
import { config } from '../config'

export interface AuthenticatedRequest extends Request {
  user?: {
    id: string
    email?: string
    role?: string
    orgId?: string
  }
}

interface JwtPayload {
  sub: string
  email?: string
  role?: string
  org_id?: string
  iat?: number
  exp?: number
}

/**
 * Build the verify options for jsonwebtoken.
 * Always pins the signing algorithm to HS256 to prevent algorithm-confusion
 * attacks (e.g. the "alg: none" or RS256/HS256 key-confusion class). Issuer
 * and audience are pinned when configured.
 */
function getVerifyOptions(): jwt.VerifyOptions {
  const options: jwt.VerifyOptions = {
    algorithms: ['HS256']
  }
  if (config.jwt.issuer) {
    options.issuer = config.jwt.issuer
  }
  if (config.jwt.audience) {
    options.audience = config.jwt.audience
  }
  return options
}

/**
 * JWT authentication middleware.
 * Validates Bearer token from Authorization header.
 * Adds user info to request object if valid.
 */
export const authMiddleware = (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization

  if (!authHeader) {
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'No authorization header provided'
    })
  }

  const parts = authHeader.split(' ')
  if (parts.length !== 2 || parts[0] !== 'Bearer') {
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'Invalid authorization header format. Expected: Bearer <token>'
    })
  }

  const token = parts[1]

  try {
    const decoded = jwt.verify(token, config.jwt.secret, getVerifyOptions()) as JwtPayload

    req.user = {
      id: decoded.sub,
      email: decoded.email,
      role: decoded.role,
      orgId: decoded.org_id
    }

    next()
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Token has expired'
      })
    }

    if (error instanceof jwt.JsonWebTokenError) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Invalid token'
      })
    }

    return res.status(401).json({
      error: 'Unauthorized',
      message: 'Authentication failed'
    })
  }
}

/**
 * Optional authentication middleware.
 * Adds user info to request if valid token provided, but doesn't require it.
 */
export const optionalAuthMiddleware = (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) => {
  const authHeader = req.headers.authorization

  if (!authHeader) {
    return next()
  }

  const parts = authHeader.split(' ')
  if (parts.length !== 2 || parts[0] !== 'Bearer') {
    return next()
  }

  const token = parts[1]

  try {
    const decoded = jwt.verify(token, config.jwt.secret, getVerifyOptions()) as JwtPayload

    req.user = {
      id: decoded.sub,
      email: decoded.email,
      role: decoded.role,
      orgId: decoded.org_id
    }
  } catch {
    // Ignore invalid tokens for optional auth
  }

  next()
}

/**
 * Role-based authorization middleware.
 * Requires authMiddleware to run first.
 * @param allowedRoles - Array of roles allowed to access the route
 */
export const requireRole = (...allowedRoles: string[]) => {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Authentication required'
      })
    }

    if (!req.user.role || !allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'Insufficient permissions'
      })
    }

    next()
  }
}
