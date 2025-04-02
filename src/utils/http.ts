// http.ts
import axios, { AxiosInstance } from 'axios';
import { HTTP_TIMEOUT } from './config';

const createInstance = (): AxiosInstance => {
  return axios.create({
    timeout: HTTP_TIMEOUT, // Default timeout: 10 seconds
  });
};

export const http = createInstance();
