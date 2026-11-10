/** Every file of the asset folder. */
export declare const voiceCaptureAssets: readonly string[];
/** Copies the asset files into `outputDirectory` and returns their names. */
export declare function copyVoiceCaptureAssets(outputDirectory: string): Promise<readonly string[]>;
