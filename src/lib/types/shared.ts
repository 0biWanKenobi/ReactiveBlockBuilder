export type OpResult =
    | { success: true, message?: string }
    | { success: false, message: string }