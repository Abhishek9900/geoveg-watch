import { createSlice, type PayloadAction } from "@reduxjs/toolkit";

export type LayerKey = "green" | "water" | "moisture" | "burn" | "sar";

interface LayerState {
  activeLayer: LayerKey;
}

const initialState: LayerState = {
  activeLayer: "green",
};

const layerSlice = createSlice({
  name: "layer",
  initialState,
  reducers: {
    layerChanged(state, action: PayloadAction<LayerKey>) {
      state.activeLayer = action.payload;
    },
  },
});

export const { layerChanged } = layerSlice.actions;
export default layerSlice.reducer;
