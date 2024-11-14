interface MessageFragment {
    type: string;
    text: string;
    emote: {
      id: string;
      emote_set_id: string;
      owner_id: string;
      format: string[];
    } | null;
    cheermote: any | null;
    mention: any | null;
}