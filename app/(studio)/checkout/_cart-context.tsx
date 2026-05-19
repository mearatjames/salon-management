"use client";

// CartProvider / useCart — React Context + reducer wrapping the pure
// helpers in `_cart.ts`. The ephemeral-cart screen at `/checkout`
// mounts the provider; on unmount the cart is garbage-collected
// (FR-011: no localStorage/sessionStorage persistence).
//
// Reducer actions are intentionally narrow and named after operator
// gestures: `add_item` (picking a service tile), `remove_item`
// (clicking the trash on a row), `set_item_tech` (per-row tech swap),
// `set_item_note` (per-row note), `set_customer` / `set_tech`
// (header selections), `set_discount` (discount-sheet apply),
// `set_notes` (cart-level memo), `reset` (post-commit cleanup).
//
// No persistence side-effects. No fetch. The commit Server Actions
// (US1/2/3) read the cart from `useCart().cart` at submit time.

import { createContext, useCallback, useContext, useMemo, useReducer, type ReactNode } from "react";

import {
  type CartDiscount,
  type CartItem,
  type EphemeralCart,
  addItem as addItemPure,
  emptyCart,
  removeItem as removeItemPure,
} from "./_cart";

type Action =
  | { type: "add_item"; item: CartItem }
  | { type: "remove_item"; localId: string }
  | { type: "set_item_tech"; localId: string; techId: string }
  | { type: "set_item_note"; localId: string; note: string | null }
  | { type: "set_customer"; customerId: string | null }
  | { type: "set_tech"; techId: string | null }
  | { type: "set_discount"; discount: CartDiscount | null }
  | { type: "set_notes"; notes: string | null }
  | { type: "reset" };

function reducer(state: EphemeralCart, action: Action): EphemeralCart {
  switch (action.type) {
    case "add_item":
      return addItemPure(state, action.item);
    case "remove_item":
      return removeItemPure(state, action.localId);
    case "set_item_tech":
      return {
        ...state,
        items: state.items.map((i) =>
          i.localId === action.localId ? { ...i, techId: action.techId } : i
        ),
      };
    case "set_item_note":
      return {
        ...state,
        items: state.items.map((i) =>
          i.localId === action.localId ? { ...i, note: action.note } : i
        ),
      };
    case "set_customer":
      return { ...state, customerId: action.customerId };
    case "set_tech":
      return { ...state, techId: action.techId };
    case "set_discount":
      return { ...state, discount: action.discount };
    case "set_notes":
      return { ...state, notes: action.notes };
    case "reset":
      return emptyCart();
    default: {
      const exhaustive: never = action;
      return exhaustive;
    }
  }
}

export type CartActions = {
  addItem: (item: CartItem) => void;
  removeItem: (localId: string) => void;
  setItemTech: (localId: string, techId: string) => void;
  setItemNote: (localId: string, note: string | null) => void;
  setCustomer: (customerId: string | null) => void;
  setTech: (techId: string | null) => void;
  setDiscount: (discount: CartDiscount | null) => void;
  setNotes: (notes: string | null) => void;
  reset: () => void;
};

export type CartContextValue = {
  cart: EphemeralCart;
  actions: CartActions;
};

const CartContext = createContext<CartContextValue | null>(null);

export function CartProvider({ children }: { children: ReactNode }) {
  const [cart, dispatch] = useReducer(reducer, undefined, emptyCart);

  // Stabilize each action with `useCallback` so consumer components
  // that depend on them don't re-render unnecessarily.
  const addItem = useCallback((item: CartItem) => dispatch({ type: "add_item", item }), []);
  const removeItem = useCallback(
    (localId: string) => dispatch({ type: "remove_item", localId }),
    []
  );
  const setItemTech = useCallback(
    (localId: string, techId: string) => dispatch({ type: "set_item_tech", localId, techId }),
    []
  );
  const setItemNote = useCallback(
    (localId: string, note: string | null) => dispatch({ type: "set_item_note", localId, note }),
    []
  );
  const setCustomer = useCallback(
    (customerId: string | null) => dispatch({ type: "set_customer", customerId }),
    []
  );
  const setTech = useCallback(
    (techId: string | null) => dispatch({ type: "set_tech", techId }),
    []
  );
  const setDiscount = useCallback(
    (discount: CartDiscount | null) => dispatch({ type: "set_discount", discount }),
    []
  );
  const setNotes = useCallback(
    (notes: string | null) => dispatch({ type: "set_notes", notes }),
    []
  );
  const reset = useCallback(() => dispatch({ type: "reset" }), []);

  const value = useMemo<CartContextValue>(
    () => ({
      cart,
      actions: {
        addItem,
        removeItem,
        setItemTech,
        setItemNote,
        setCustomer,
        setTech,
        setDiscount,
        setNotes,
        reset,
      },
    }),
    [
      cart,
      addItem,
      removeItem,
      setItemTech,
      setItemNote,
      setCustomer,
      setTech,
      setDiscount,
      setNotes,
      reset,
    ]
  );

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart(): CartContextValue {
  const ctx = useContext(CartContext);
  if (!ctx) {
    throw new Error("useCart must be used within <CartProvider>");
  }
  return ctx;
}
