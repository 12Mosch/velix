declare module "@garmin/fitsdk" {
	export const Encoder: new () => {
		onMesg: (mesgNum: number, mesg: Record<string, unknown>) => unknown;
		close: () => Uint8Array;
	};
	export const Decoder: {
		new (
			stream: unknown,
		): {
			isFIT: () => boolean;
			checkIntegrity: () => boolean;
			read: (options?: Record<string, unknown>) => {
				messages: Record<string, unknown[]>;
				errors: unknown[];
			};
		};
		isFIT: (stream: unknown) => boolean;
	};
	export const Stream: {
		fromByteArray: (bytes: ArrayLike<number>) => unknown;
		fromArrayBuffer: (buffer: ArrayBuffer) => unknown;
	};
	export const Profile: {
		MesgNum: Record<string, number>;
	};
}
