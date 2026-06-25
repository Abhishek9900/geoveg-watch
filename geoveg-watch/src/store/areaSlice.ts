import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import type { AreaHistoryResponse, AreaPolygon } from "@/types";

interface AreaState {
  selectedPolygon: AreaPolygon | null;
  history: AreaHistoryResponse | null;
  activeYear: number | null;
  isLoading: boolean;
  elapsedSeconds: number | null;
  error: string | null;
}

const initialState: AreaState = {
  selectedPolygon: null,
  history: null,
  activeYear: null,
  isLoading: false,
  elapsedSeconds: null,
  error: null,
};

const areaSlice = createSlice({
  name: "area",
  initialState,
  reducers: {
    areaSelected(state, action: PayloadAction<AreaPolygon>) {
      state.selectedPolygon = action.payload;
      state.history = null;
      state.activeYear = null;
      state.error = null;
    },
    historyRequestStarted(state) {
      state.isLoading = true;
      state.error = null;
      state.elapsedSeconds = 0;
    },
    historyRequestTick(state) {
      if (state.elapsedSeconds !== null) state.elapsedSeconds += 1;
    },
    historyRequestSucceeded(state, action: PayloadAction<AreaHistoryResponse>) {
      state.isLoading = false;
      state.history = action.payload;
      const years = action.payload.years;
      const lastValid = [...years].reverse().find((y) => y.greenCoverPct !== null);
      state.activeYear = (lastValid ?? years[years.length - 1])?.year ?? action.payload.availableRange.to;
    },
    historyRequestFailed(state, action: PayloadAction<string>) {
      state.isLoading = false;
      state.error = action.payload;
    },
    activeYearChanged(state, action: PayloadAction<number>) {
      state.activeYear = action.payload;
    },
    selectionCleared(state) {
      state.selectedPolygon = null;
      state.history = null;
      state.activeYear = null;
      state.error = null;
    },
    backToSelection(state) {
      state.history = null;
      state.activeYear = null;
    },
  },
});

export const {
  areaSelected,
  historyRequestStarted,
  historyRequestTick,
  historyRequestSucceeded,
  historyRequestFailed,
  activeYearChanged,
  selectionCleared,
  backToSelection,
} = areaSlice.actions;

export default areaSlice.reducer;
