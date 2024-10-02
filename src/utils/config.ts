import dotenv from 'dotenv';

dotenv.config();

export const config = {
  SQLITE_DB_PATH: process.env.SQLITE_DB_PATH || './database.sqlite',
  CLIENTSECRET: process.env.CLIENTSECRET,
  CLIENTID: process.env.CLIENTID,
  DOMINIO: process.env.DOMINIO,
  PORT: process.env.PORT,
  JWT_SECRET: process.env.JWT_SECRET,
};

