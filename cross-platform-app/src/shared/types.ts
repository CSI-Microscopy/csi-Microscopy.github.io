// src/shared/types.ts

export interface User {
    id: number;
    name: string;
    email: string;
}

export interface Response<T> {
    data: T;
    error?: string;
}