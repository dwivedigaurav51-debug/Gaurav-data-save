package com.envarg.qrhisab;
import android.content.*;import android.database.*;import android.net.Uri;import android.os.*;import java.io.*;
public class ShareProvider extends ContentProvider {
 public boolean onCreate(){return true;}
 private File file(Uri u)throws FileNotFoundException {String name=u.getLastPathSegment();if(name==null||name.contains("/")||name.contains(".."))throw new FileNotFoundException();File dir=new File(getContext().getCacheDir(),"shared");File f=new File(dir,name);if(!f.exists())throw new FileNotFoundException();return f;}
 public ParcelFileDescriptor openFile(Uri u,String mode)throws FileNotFoundException{if(!"r".equals(mode))throw new FileNotFoundException();return ParcelFileDescriptor.open(file(u),ParcelFileDescriptor.MODE_READ_ONLY);}
 public String getType(Uri u){String s=u.toString();return s.endsWith(".pdf")?"application/pdf":s.endsWith(".png")?"image/png":s.endsWith(".json")?"application/json":s.endsWith(".csv")?"text/csv":"text/plain";}
 public Cursor query(Uri u,String[] projection,String selection,String[] args,String sort){try{File f=file(u);String[] cols=projection==null?new String[]{"_display_name","_size"}:projection;MatrixCursor c=new MatrixCursor(cols);Object[] row=new Object[cols.length];for(int i=0;i<cols.length;i++)row[i]=cols[i].equals("_display_name")?f.getName():cols[i].equals("_size")?f.length():null;c.addRow(row);return c;}catch(Exception e){return null;}}
 public Uri insert(Uri u,ContentValues v){throw new UnsupportedOperationException();}public int delete(Uri u,String s,String[] a){return 0;}public int update(Uri u,ContentValues v,String s,String[] a){return 0;}
}
