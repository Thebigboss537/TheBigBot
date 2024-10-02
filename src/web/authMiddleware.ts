import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../utils/config';

interface AuthRequest extends Request {
    user?: jwt.JwtPayload;
}

const authMiddleware = (req: AuthRequest, res: Response, next: NextFunction) => {
    console.log('Auth Middleware: Checking for token');

    let token: string | undefined;

    // Primero, intentar obtener el token del encabezado de autorización
    const authHeader = req.header('Authorization');
    if (authHeader && authHeader.startsWith('Bearer ')) {
        token = authHeader.replace('Bearer ', '');
        console.log('Auth Middleware: Token extracted from header', token.substring(0, 10) + '...');
    }

    // Si no hay token en el encabezado, intentar obtenerlo del parámetro 'state' en la query
    if (!token && req.query && typeof req.query.state === 'string') {
        token = req.query.state;
        console.log('Auth Middleware: Token extracted from state parameter', token.substring(0, 10) + '...');
    }

    if (!token) {
        console.log('Auth Middleware: No token found in header or state parameter');
        return res.status(401).json({ error: 'No authentication token provided' });
    }

    try {
        console.log('Auth Middleware: Attempting to verify token');
        const decoded = jwt.verify(token, config.JWT_SECRET || '') as jwt.JwtPayload;
        console.log('Auth Middleware: Token verified successfully', decoded);
        req.user = decoded;
        next();
    } catch (error) {
        console.error('Auth Middleware: Error verifying token', error);
        if (error instanceof jwt.JsonWebTokenError) {
            return res.status(401).json({ error: 'Invalid token' });
        }
        if (error instanceof jwt.TokenExpiredError) {
            return res.status(401).json({ error: 'Token expired' });
        }
        res.status(500).json({ error: 'Internal server error during authentication' });
    }
};

const softAuthCheck = (pageToRender: string) => {
    return (req: AuthRequest, res: Response, next: NextFunction) => {
      const token = req.cookies.token || req.header('Authorization')?.replace('Bearer ', '');
      
      if (!token) {
        // Si no hay token, renderiza la página con un flag que indica que se requiere autenticación
        return res.render(pageToRender, { requiresAuth: true });
      }
  
      // Si hay un token, lo adjuntamos a la solicitud para uso posterior si es necesario
      req.user = { token };
      
      // Continuamos con la siguiente función en la cadena de middleware
      next();
    };
  };

export { authMiddleware, softAuthCheck };