import { configureStore } from "@reduxjs/toolkit";
import areaReducer from "@/store/areaSlice";
import layerReducer from "@/store/layerSlice";

export const store = configureStore({
  reducer: {
    area: areaReducer,
    layer: layerReducer,
  },
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
