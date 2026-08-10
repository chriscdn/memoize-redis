// import { isError } from "@chriscdn/type-guards";
// import v8 from "node:v8";

// const assertSerializable = (obj: unknown) => {
//   try {
//     // This performs a ultra-fast binary serialization run natively
//     v8.serialize(obj);
//   } catch (error) {
//     if (isError(error)) {
//       throw new TypeError(`Data is not serializable: ${error.message}`);
//     } else {
//       throw new TypeError("Data is not serializable");
//     }
//   }
// };

// export { assertSerializable };
